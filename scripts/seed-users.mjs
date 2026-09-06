// Creates throwaway local test accounts (idempotent). Local dev only.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const users = ["bob", "carol", "dave"];
for (const name of users) {
  const email = `${name}@test.local`;
  const { error } = await admin.auth.admin.createUser({
    email,
    password: `localtest-pass-1`,
    email_confirm: true,
    user_metadata: { display_name: name[0].toUpperCase() + name.slice(1) },
  });
  console.log(email, error ? `skip (${error.message})` : "created");
}
