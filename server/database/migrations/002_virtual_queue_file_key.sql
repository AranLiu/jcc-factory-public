ALTER TABLE ai_tasks
  DROP INDEX uq_ai_tasks_active_queue_file;

ALTER TABLE ai_tasks
  DROP COLUMN active_queue_file_id;

ALTER TABLE ai_tasks
  ADD COLUMN active_queue_file_id INT
  GENERATED ALWAYS AS (
    CASE
      WHEN task_source = 'queue' AND status IN ('pending', 'processing', 'paused')
        THEN file_id
      ELSE NULL
    END
  ) VIRTUAL;

CREATE UNIQUE INDEX uq_ai_tasks_active_queue_file
  ON ai_tasks(active_queue_file_id);
