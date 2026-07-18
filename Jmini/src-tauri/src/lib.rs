use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id: i64,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Memory {
    pub id: i64,
    pub kind: String,
    pub content: String,
    pub importance: i64,
    pub confidence: f64,
    pub created_at: String,
    pub updated_at: String,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not find app data directory: {error}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;
    Ok(directory.join("jmini.db"))
}

fn connection(app: &AppHandle) -> Result<Connection, String> {
    let database = Connection::open(database_path(app)?).map_err(|error| error.to_string())?;
    database
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS conversations (
                 id TEXT PRIMARY KEY,
                 title TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messages (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                 role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                 content TEXT NOT NULL,
                 created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS messages_conversation_idx
                 ON messages(conversation_id, created_at);
             CREATE TABLE IF NOT EXISTS memories (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 kind TEXT NOT NULL,
                 content TEXT NOT NULL UNIQUE,
                 importance INTEGER NOT NULL DEFAULT 3,
                 confidence REAL NOT NULL DEFAULT 0.7,
                 embedding TEXT,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS memories_updated_idx ON memories(updated_at);",
        )
        .map_err(|error| error.to_string())?;
    Ok(database)
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

#[tauri::command]
fn create_conversation(app: AppHandle, title: Option<String>) -> Result<Conversation, String> {
    let database = connection(&app)?;
    let timestamp = now();
    let id = format!("conversation-{}", Utc::now().timestamp_nanos_opt().unwrap_or_default());
    let title = title.unwrap_or_else(|| "New conversation".to_string());
    database
        .execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![id, title, timestamp],
        )
        .map_err(|error| error.to_string())?;
    Ok(Conversation {
        id,
        title,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    })
}

#[tauri::command]
fn list_conversations(app: AppHandle) -> Result<Vec<Conversation>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
fn get_messages(app: AppHandle, conversation_id: String) -> Result<Vec<StoredMessage>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ?1 ORDER BY id")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![conversation_id], |row| {
            Ok(StoredMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_message(
    app: AppHandle,
    conversation_id: String,
    role: String,
    content: String,
) -> Result<StoredMessage, String> {
    if !["user", "assistant", "system"].contains(&role.as_str()) {
        return Err("Unsupported message role".to_string());
    }
    let database = connection(&app)?;
    let timestamp = now();
    database
        .execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![conversation_id, role, content, timestamp],
        )
        .map_err(|error| error.to_string())?;
    let id = database.last_insert_rowid();
    database
        .execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![timestamp, conversation_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(StoredMessage {
        id,
        conversation_id,
        role,
        content,
        created_at: timestamp,
    })
}

#[tauri::command]
fn rename_conversation(app: AppHandle, conversation_id: String, title: String) -> Result<(), String> {
    connection(&app)?
        .execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title.trim(), now(), conversation_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_conversation(app: AppHandle, conversation_id: String) -> Result<(), String> {
    connection(&app)?
        .execute("DELETE FROM conversations WHERE id = ?1", params![conversation_id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_memory(
    app: AppHandle,
    kind: String,
    content: String,
    importance: i64,
    confidence: f64,
    embedding: Option<Vec<f32>>,
) -> Result<Memory, String> {
    let database = connection(&app)?;
    let timestamp = now();
    let embedding_json = embedding.map(|value| serde_json::to_string(&value).unwrap_or_default());
    database
        .execute(
            "INSERT INTO memories (kind, content, importance, confidence, embedding, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(content) DO UPDATE SET kind = excluded.kind, importance = excluded.importance,
                 confidence = excluded.confidence, embedding = excluded.embedding, updated_at = excluded.updated_at",
            params![kind, content, importance, confidence, embedding_json, timestamp],
        )
        .map_err(|error| error.to_string())?;
    let memory = database
        .query_row(
            "SELECT id, kind, content, importance, confidence, created_at, updated_at FROM memories WHERE content = ?1",
            params![content],
            |row| {
                Ok(Memory {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    content: row.get(2)?,
                    importance: row.get(3)?,
                    confidence: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|error| error.to_string())?;
    Ok(memory)
}

#[tauri::command]
fn list_memories(app: AppHandle) -> Result<Vec<Memory>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT id, kind, content, importance, confidence, created_at, updated_at FROM memories ORDER BY updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Memory {
                id: row.get(0)?,
                kind: row.get(1)?,
                content: row.get(2)?,
                importance: row.get(3)?,
                confidence: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_memory(app: AppHandle, memory_id: i64) -> Result<(), String> {
    connection(&app)?
        .execute("DELETE FROM memories WHERE id = ?1", params![memory_id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
struct MemoryCandidate {
    id: i64,
    content: String,
    embedding: Option<Vec<f32>>,
}

#[tauri::command]
fn search_memories(
    app: AppHandle,
    query: String,
    query_embedding: Option<Vec<f32>>,
    limit: usize,
) -> Result<Vec<Memory>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT id, kind, content, importance, confidence, embedding, created_at, updated_at FROM memories")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let embedding_json: Option<String> = row.get(5)?;
            Ok(MemoryCandidate {
                id: row.get(0)?,
                content: row.get(2)?,
                embedding: embedding_json.and_then(|value| serde_json::from_str(&value).ok()),
            })
        })
        .map_err(|error| error.to_string())?;
    let mut scored = Vec::new();
    let query_lower = query.to_lowercase();
    for candidate in rows.flatten() {
        let score = query_embedding
            .as_ref()
            .zip(candidate.embedding.as_ref())
            .map(|(left, right)| cosine_similarity(left, right))
            .unwrap_or_else(|| keyword_score(&query_lower, &candidate.content));
        scored.push((score, candidate));
    }
    scored.sort_by(|left, right| right.0.total_cmp(&left.0));
    let mut results = Vec::new();
    for (_, candidate) in scored.into_iter().take(limit) {
        let memory = database
            .query_row(
                "SELECT id, kind, content, importance, confidence, created_at, updated_at FROM memories WHERE id = ?1",
                params![candidate.id],
                |row| {
                    Ok(Memory {
                        id: row.get(0)?,
                        kind: row.get(1)?,
                        content: row.get(2)?,
                        importance: row.get(3)?,
                        confidence: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(memory) = memory {
            results.push(memory);
        }
    }
    Ok(results)
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    if left.len() != right.len() || left.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;
    for (left_value, right_value) in left.iter().zip(right.iter()) {
        dot += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }
    let denominator = left_norm.sqrt() * right_norm.sqrt();
    if denominator == 0.0 { 0.0 } else { dot / denominator }
}

fn keyword_score(query: &str, content: &str) -> f32 {
    let content_lower = content.to_lowercase();
    query
        .split_whitespace()
        .filter(|word| word.len() > 2 && content_lower.contains(word))
        .count() as f32
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_conversation,
            list_conversations,
            get_messages,
            save_message,
            rename_conversation,
            delete_conversation,
            save_memory,
            list_memories,
            delete_memory,
            search_memories
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
