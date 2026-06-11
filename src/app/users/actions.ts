"use server";

import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY غير موجود في .env.local — أضفه من Supabase → Project Settings → API"
    );
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export type CreateUserInput = {
  full_name: string;
  email: string;
  phone?: string;
  role: "customer" | "restaurant" | "driver" | "admin";
  password: string;
};

export async function createUserAction(
  input: CreateUserInput
): Promise<{ userId?: string; error?: string }> {
  try {
    const supabase = getAdminClient();

    const { data, error } = await supabase.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: input.full_name,
        phone: input.phone ?? null,
      },
    });

    if (error) return { error: error.message };
    if (!data.user) return { error: "فشل إنشاء المستخدم" };

    const userId = data.user.id;

    // Profile is auto-created by the DB trigger with role='customer'.
    // Update role + metadata if different.
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        role: input.role,
        full_name: input.full_name,
        phone: input.phone ?? null,
      })
      .eq("id", userId);

    if (profileError) return { error: profileError.message };

    return { userId };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function deleteUserAction(
  userId: string
): Promise<{ error?: string }> {
  try {
    const supabase = getAdminClient();
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) return { error: error.message };
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}
