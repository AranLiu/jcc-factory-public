-- Split the legacy three-step completion state into the current four-step flow.
-- The old columns are retained for compatibility with archived installations.
ALTER TABLE script_units ADD COLUMN step3_character_graph_completed TINYINT(1) NOT NULL DEFAULT 0 AFTER step2_character_graph_completed;
ALTER TABLE script_units ADD COLUMN step4_completed TINYINT(1) NOT NULL DEFAULT 0 AFTER step3_completed;

UPDATE script_units
SET step3_character_graph_completed = CASE
      WHEN step3_character_graph_completed = 1
        OR step2_character_graph_completed = 1
        OR NULLIF(TRIM(character_graph_content), '') IS NOT NULL
        OR NULLIF(TRIM(enhanced_content_integration_result), '') IS NOT NULL
      THEN 1 ELSE 0
    END,
    step4_completed = CASE
      WHEN step4_completed = 1
        OR step3_completed = 1
        OR NULLIF(TRIM(character_integration_result), '') IS NOT NULL
      THEN 1 ELSE 0
    END;
