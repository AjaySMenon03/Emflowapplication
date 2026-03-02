/**
 * KV Store Model — Simple key-value interface backed by Supabase table.
 *
 * Table schema:
 *   CREATE TABLE kv_store_5252bcc1 (
 *     key TEXT NOT NULL PRIMARY KEY,
 *     value JSONB NOT NULL
 *   );
 */
import { createClient } from "@supabase/supabase-js";

const TABLE = "kv_store_5252bcc1";

function client() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

/** Set a key-value pair (upsert). */
export async function set(key, value) {
    const supabase = client();
    const { error } = await supabase.from(TABLE).upsert({ key, value });
    if (error) throw new Error(error.message);
}

/** Get a single value by key. */
export async function get(key) {
    const supabase = client();
    const { data, error } = await supabase
        .from(TABLE)
        .select("value")
        .eq("key", key)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.value;
}

/** Delete a key. */
export async function del(key) {
    const supabase = client();
    const { error } = await supabase.from(TABLE).delete().eq("key", key);
    if (error) throw new Error(error.message);
}

/** Set multiple key-value pairs. */
export async function mset(keys, values) {
    const supabase = client();
    const { error } = await supabase
        .from(TABLE)
        .upsert(keys.map((k, i) => ({ key: k, value: values[i] })));
    if (error) throw new Error(error.message);
}

/** Get multiple values by keys. */
export async function mget(keys) {
    const supabase = client();
    const { data, error } = await supabase
        .from(TABLE)
        .select("value")
        .in("key", keys);
    if (error) throw new Error(error.message);
    return data?.map((d) => d.value) ?? [];
}

/** Delete multiple keys. */
export async function mdel(keys) {
    const supabase = client();
    const { error } = await supabase.from(TABLE).delete().in("key", keys);
    if (error) throw new Error(error.message);
}

/** Search for key-value pairs by prefix. */
export async function getByPrefix(prefix) {
    const supabase = client();
    const { data, error } = await supabase
        .from(TABLE)
        .select("key, value")
        .like("key", prefix + "%");
    if (error) throw new Error(error.message);
    return data?.map((d) => d.value) ?? [];
}
