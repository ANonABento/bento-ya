use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Database error: {0}")]
    DatabaseError(String),

    #[error("Command error: {0}")]
    CommandError(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        match err {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Record not found".to_string())
            }
            _ => AppError::DatabaseError(err.to_string()),
        }
    }
}

// Tauri requires serializable errors
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        let (kind, message) = match self {
            AppError::NotFound(msg) => ("NotFound", msg.as_str()),
            AppError::InvalidInput(msg) => ("InvalidInput", msg.as_str()),
            AppError::DatabaseError(msg) => ("DatabaseError", msg.as_str()),
            AppError::CommandError(msg) => ("CommandError", msg.as_str()),
        };
        state.serialize_field("kind", kind)?;
        state.serialize_field("message", message)?;
        state.end()
    }
}
