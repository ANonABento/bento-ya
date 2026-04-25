//! Pipeline Engine
//!
//! Handles column triggers and exit criteria evaluation.
//! When a task enters a column, the pipeline fires the column's trigger.
//! When exit criteria are met, the task auto-advances to the next column.

mod completion;
pub mod dependencies;
mod engine;
mod events;
mod exit;
mod state;
pub mod template;
pub mod triggers;

pub use completion::{
    decide_completion, handle_trigger_failure, mark_complete, mark_complete_with_error,
    CompletionAction,
};
pub use engine::{fire_trigger, try_auto_advance};
pub use events::{
    emit_pipeline, emit_tasks_changed, PipelineEvent, TasksChangedEvent, WebhookPayload,
    EVT_ADVANCED, EVT_DEP_MOVED, EVT_RUNNING, EVT_TRIGGERED, EVT_UNBLOCKED,
};
pub use exit::{check_exit_met, evaluate_exit_criteria, parse_exit_type};
pub use state::PipelineState;
