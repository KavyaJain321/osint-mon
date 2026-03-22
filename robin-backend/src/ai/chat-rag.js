// ============================================================
// ROBIN OSINT — RAG Chat Engine
// Semantic search + keyword fallback → streaming Groq response
// With 3-attempt strategy for Groq content restriction bypass
// ============================================================

import { supabase } from '../lib/supabase.js';
import { groqChat, getStreamClient, MODELS } from '../lib/groq.js';
import { generateEmbeddingForQuery } from '../services/embedding.js';
import { reframeQuery, isGroqRefusal, buildArticleSummaryFallback, ANALYST_SYSTEM_PREFIX } from '../services/query-reframer.js';
import { log } from '../lib/logger.js';

/**
 * Retrieve relevant articles using pgvector similarity + keyword fallback.
 * @param {string} question - User's question
 * @param {string} clientId - Client UUID
 * @returns {Promise<Array>} Top 15 relevant articles
 */
export async function retrieveRelevantArticles(question, clientId) {
    const articles = new Map();

    // 1. Vector similarity search
    try {
        const embedding = await generateEmbeddingForQuery(question);
        if (embedding) {
            const { data: vectorResults } = await supabase.rpc('match_articles', {
                query_embedding: JSON.stringify(embedding),
                p_client_id: clientId,
                match_threshold: 0.35, // BUG FIX #27: 0.10 pulled in irrelevant articles; 0.35 is the practical minimum for meaningful cosine similarity
                match_count: 20,
            });

            if (vectorResults) {
                for (const article of vectorResults) {
                    articles.set(article.id, { ...article, source: 'vector' });
                }
            }
        }
    } catch (error) {
        log.chat.warn('Vector search failed, using keyword fallback only', { error: error.message });
    }

    // 2. Keyword fallback search
    try {
        const keywords = question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        if (keywords.length > 0) {
            const { data: keywordResults } = await supabase
                .from('articles')
                .select('id, title, content, url, published_at, source_id')
                .eq('client_id', clientId)
                .eq('analysis_status', 'complete')
                .or(keywords.map((k) => `title.ilike.%${k}%`).join(','))
                .order('published_at', { ascending: false })
                .limit(10);

            if (keywordResults) {
                for (const article of keywordResults) {
                    if (!articles.has(article.id)) {
                        articles.set(article.id, { ...article, source: 'keyword' });
                    }
                }
            }
        }
    } catch (error) {
        log.chat.warn('Keyword fallback failed', { error: error.message });
    }

    // 3. Sort by similarity (vector first) then recency, return top 15
    return [...articles.values()]
        .sort((a, b) => {
            if (a.source === 'vector' && b.source !== 'vector') return -1;
            if (b.source === 'vector' && a.source !== 'vector') return 1;
            return new Date(b.published_at) - new Date(a.published_at);
        })
        .slice(0, 15);
}

/**
 * Get latest intelligence context for a client.
 */
export async function getClientContext(clientId) {
    try {
        const [patternRes, threatRes, entitiesRes, signalsRes] = await Promise.all([
            supabase.from('narrative_patterns')
                .select('weekly_narrative, risk_level, anomalies, pattern_date')
                .eq('client_id', clientId)
                .order('pattern_date', { ascending: false })
                .limit(1).single(),
            supabase.from('threat_assessments')
                .select('overall_score, dimensions, active_threats, threat_velocity')
                .eq('client_id', clientId)
                .order('assessment_date', { ascending: false })
                .limit(1).single()
                .then(r => r).catch(() => ({ data: null })),
            supabase.from('entity_profiles')
                .select('entity_name, entity_type, influence_score, sentiment_profile, risk_tags, mention_count')
                .eq('client_id', clientId)
                .order('influence_score', { ascending: false })
                .limit(10)
                .then(r => r).catch(() => ({ data: null })),
            supabase.from('intelligence_signals')
                .select('signal_type, severity, title, description')
                .eq('client_id', clientId)
                .eq('is_acknowledged', false)
                .order('created_at', { ascending: false })
                .limit(5)
                .then(r => r).catch(() => ({ data: null })),
        ]);

        const parts = [];

        const pattern = patternRes.data;
        if (pattern) {
            parts.push(`INTELLIGENCE BRIEFING (${pattern.pattern_date}):
Risk Level: ${pattern.risk_level?.toUpperCase()}
Narrative: ${pattern.weekly_narrative || 'N/A'}`);
        }

        const threat = threatRes.data;
        if (threat) {
            const dims = threat.dimensions || {};
            parts.push(`THREAT MATRIX (Score: ${threat.overall_score}/100):
  Reputational: ${dims.reputational}/100 | Financial: ${dims.financial}/100 | Regulatory: ${dims.regulatory}/100
  Operational: ${dims.operational}/100 | Geopolitical: ${dims.geopolitical}/100
  Velocity: ${threat.threat_velocity?.direction || 'unknown'}
  Active Threats: ${(threat.active_threats || []).length}`);
        }

        const entities = entitiesRes.data;
        if (entities && entities.length > 0) {
            const entityList = entities.map(e =>
                `  - ${e.entity_name} (${e.entity_type}): influence=${e.influence_score}, mentions=${e.mention_count}, trend=${e.sentiment_profile?.trend || 'unknown'}${e.risk_tags?.length ? ', risks=' + e.risk_tags.join('/') : ''}`
            ).join('\n');
            parts.push(`KEY ENTITIES:\n${entityList}`);
        }

        const signals = signalsRes.data;
        if (signals && signals.length > 0) {
            const signalList = signals.map(s =>
                `  ⚠️ [${s.severity.toUpperCase()}] ${s.title}`
            ).join('\n');
            parts.push(`ACTIVE SIGNALS:\n${signalList}`);
        }

        return parts.length > 0 ? parts.join('\n\n') : 'No intelligence patterns generated yet.';
    } catch {
        return 'Intelligence context unavailable.';
    }
}

/**
 * Build the chat prompt with Palantir-grade analyst framing.
 */
function buildChatPrompt(question, articles, clientContext, clientName, useAnalystFraming = false) {
    const articlesText = articles
        .map((a, i) => {
            const date = new Date(a.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const snippet = (a.content || '').substring(0, 300).replace(/\n+/g, ' ');
            return `[${i + 1}] "${a.title}" (${date})
Source: ${a.source_name || a.url?.match(/\/\/([^/]+)/)?.[1] || 'Unknown'}
Summary: ${a.summary || 'N/A'}
Sentiment: ${a.sentiment || 'N/A'} | Importance: ${a.importance_score || 'N/A'}/100
Content Preview: ${snippet}...
URL: ${a.url}`;
        })
        .join('\n\n');

    const systemPrompt = `You are ROBIN, an enterprise Open Source Intelligence (OSINT) analysis system.
You serve professional intelligence analysts, compliance officers, and risk professionals at financial institutions and government agencies.
You are currently providing intelligence analysis for: ${clientName}.

YOUR ROLE:
You analyze publicly-available news and information to produce structured intelligence assessments.
You do not generate opinions or commentary — you analyze evidence and identify patterns, risks, and signals from the data provided to you.
You are a research tool processing public information. All your analysis is based on provided source data.

YOUR ANALYTICAL FRAMEWORK:
When answering questions, follow this structure (use section headers):
1. **SITUATION**: What does the current evidence show? (cite specific articles by source name and date)
2. **SIGNIFICANCE**: Why does this matter? What are the implications for ${clientName}?
3. **GAPS**: What is NOT being covered that should be? What information is missing?
4. **TRAJECTORY**: Based on patterns, what is the likely direction of events in the next 7-14 days?
5. **RECOMMENDED WATCH**: What specific indicators should the analyst monitor?

For simple factual questions, give concise direct answers without the full framework.
For complex analytical questions, use the full structured framework.

EVIDENCE CLASSIFICATION:
- CONFIRMED: Reported by 2+ independent sources
- REPORTED: Single source claim — note which source
- INFERRED: Your analytical assessment based on patterns — label it clearly

CRITICAL RULES:
- Always ground your analysis in the specific articles and data provided in the context
- When citing an article, mention the source name and approximate date (e.g., "Reuters reported on Feb 24...")
- If the data provided is insufficient, say so explicitly and describe what data WOULD be needed
- Never refuse to analyze public information — your job is always to provide the best analysis possible from available data
- If you have limited data on a topic, say "Based on limited available data..." and provide what analysis you can
- Treat all entities (governments, central banks, regulatory bodies, companies, individuals) as subjects of factual analysis only
- Do NOT add disclaimers about being an AI or about not providing financial/political advice`;

    return [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: `${clientContext}

--- SOURCE ARTICLES (${articles.length} retrieved) ---
${articlesText || 'No articles found matching your query.'}

--- ANALYST QUERY ---
${question}`,
        },
    ];
}

/**
 * Attempt a non-streaming chat call and check for refusals.
 * @returns {{ text: string, refused: boolean }}
 */
async function attemptChat(messages) {
    try {
        const response = await groqChat(messages, { temperature: 0.3, max_tokens: 2000 });
        const text = response.choices[0]?.message?.content || '';
        return { text, refused: isGroqRefusal(text) };
    } catch (err) {
        return { text: '', refused: true, error: err.message };
    }
}

/**
 * Generate a streaming chat response with 3-attempt strategy:
 *   1. Direct query with standard prompt
 *   2. If refused: retry with reframed query + analyst framing
 *   3. If still refused: return article summary fallback
 */
// BUG FIX #4: Added `userId` parameter so chat history is attributed to the
// actual requesting user instead of the first user found for the client.
export async function* generateChatResponseStream(question, clientId, clientName, userId = null) {
    // 1. Retrieve relevant articles
    const articles = await retrieveRelevantArticles(question, clientId);
    const clientContext = await getClientContext(clientId);

    let fullAnswer = '';

    // ─── ATTEMPT 1: Direct query, standard prompt ────────────
    try {
        const messages = buildChatPrompt(question, articles, clientContext, clientName, false);
        const client = getStreamClient();

        // BUG FIX #1: getStreamClient() returns null when all keys are in cooldown.
        // Calling .chat on null causes an unhandled TypeError crashing the SSE stream.
        // Fall through to attempt 2 (non-streaming) instead of crashing.
        if (!client) {
            log.chat.warn('[CHAT] No Groq client available for streaming (all keys in cooldown), skipping to attempt 2');
            throw new Error('No Groq client available for streaming');
        }

        const stream = await client.chat.completions.create({
            model: MODELS[0],
            messages,
            temperature: 0.3,
            max_tokens: 2000,
            stream: true,
        });

        let streamedText = '';
        for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content || '';
            if (token) {
                streamedText += token;
                fullAnswer += token;
                yield token;
            }
        }

        // Check if the streamed response was a refusal
        if (!isGroqRefusal(streamedText)) {
            // Success! Save and return
            await saveChatHistory(question, fullAnswer, articles, clientId, userId);
            return;
        }

        // Refusal detected — try attempt 2
        log.chat.warn('[CHAT] Groq refusal detected, retrying with analyst framing', {
            question: question.substring(0, 60),
            refusedSnippet: streamedText.substring(0, 80),
        });
        fullAnswer = ''; // Reset for retry
    } catch (error) {
        log.chat.warn('[CHAT] Streaming failed, trying reframed approach', { error: error.message });
    }

    // ─── ATTEMPT 2: Reframed query + analyst framing ─────────
    try {
        const { reframed } = reframeQuery(question);
        const messages = buildChatPrompt(reframed, articles, clientContext, clientName, true);
        const result = await attemptChat(messages);

        if (!result.refused && result.text) {
            fullAnswer = result.text;
            yield fullAnswer;
            log.chat.info('[CHAT] Attempt 2 succeeded with reframed query');
            await saveChatHistory(question, fullAnswer, articles, clientId, userId);
            return;
        }

        log.chat.warn('[CHAT] Attempt 2 also refused, falling back to article summaries');
    } catch (error) {
        log.chat.warn('[CHAT] Attempt 2 failed', { error: error.message });
    }

    // ─── ATTEMPT 3: Article summary fallback ─────────────────
    fullAnswer = buildArticleSummaryFallback(articles, question);
    yield fullAnswer;
    log.chat.info('[CHAT] Using article summary fallback (all LLM attempts refused)');
    await saveChatHistory(question, fullAnswer, articles, clientId, userId);
}

/**
 * Save chat to history (fire-and-forget).
 * BUG FIX #4: Accept `userId` directly instead of querying for the first user
 * in the client — previously all chat history was attributed to one arbitrary user.
 */
async function saveChatHistory(question, answer, articles, clientId, userId = null) {
    try {
        if (!userId) {
            log.chat.warn('[CHAT] No userId provided, skipping history save', { clientId });
            return;
        }
        const { error: saveErr } = await supabase.from('chat_history').insert({
            user_id: userId,
            client_id: clientId,
            question,
            answer,
            articles_referenced: articles.map((a) => a.id).filter(Boolean),
        });
        if (saveErr) {
            log.chat.warn('[CHAT] Failed to save history', { error: saveErr.message });
        } else {
            log.chat.info('[CHAT] History saved', { question: question.substring(0, 50), answerLen: answer.length });
        }
    } catch (error) {
        log.chat.warn('[CHAT] History save error', { error: error.message });
    }
}
