-- 013_task_script_exit_code.sql: Add last_script_exit_code to tasks for script trigger tracking

ALTER TABLE tasks ADD COLUMN last_script_exit_code INTEGER;
