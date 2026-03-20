-- Migration 008: Add 'newspaper' to content_items content_type CHECK constraint
-- Run this in the Supabase SQL Editor.

ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_content_type_check;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_content_type_check
  CHECK (content_type IN (
    'article',
    'video',
    'tv_transcript',
    'podcast',
    'pdf',
    'govt_release',
    'press_release',
    'tweet',
    'reddit',
    'newspaper'
  ));
