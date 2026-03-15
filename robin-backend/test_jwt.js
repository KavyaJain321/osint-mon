import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function test() {
    console.log("URL:", process.env.SUPABASE_URL);
    // Create client using Anon key for login
    const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    console.log("Logging in...");
    // Let's create a random user or just login if we have a test user. 
    // Wait, let's just create a new user to test the JWT!
    const email = `test-${Date.now()}@test.com`;
    const password = 'password123';

    let token = null;

    // We don't have sign-up enabled for just anyone, but let's try
    const { data: signUpData, error: signUpError } = await supabaseAnon.auth.signUp({ email, password });

    if (signUpError) {
        console.log("SignUp Failed:", signUpError.message);
        // Maybe try login with admin@robin.io?
        const { data, error } = await supabaseAnon.auth.signInWithPassword({ email: 'admin@robin.io', password: 'admin' });
        if (error) {
            console.log("Login also failed:", error.message);
            return;
        }
        token = data.session.access_token;
    } else {
        token = signUpData.session?.access_token;
    }

    if (!token) {
        console.log("No token generated");
        return;
    }

    console.log("Got token length:", token.length);

    // Try to verify token using a client created with Anon Key
    console.log("Verifying with Anon Key...");
    const { data: userAnon, error: errAnon } = await supabaseAnon.auth.getUser(token);
    console.log("Anon Result:", errAnon ? errAnon.message : "Success");

    // Try to verify token using a client created with Service Role Key
    if (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) { // replace with real service key if available
        console.log("Verifying with Service Role Key...");
        const supabaseService = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
        const { data: userService, error: errService } = await supabaseService.auth.getUser(token);
        console.log("Service Result:", errService ? errService.message : "Success");
    }
}

test();
