-- Bring the project-level prompt overrides used by the video and script workflows
-- into the ordered schema migration chain.
ALTER TABLE projects ADD COLUMN character_knowledge_graph_prompt TEXT AFTER integration_prompt;
ALTER TABLE projects ADD COLUMN character_integration_prompt TEXT AFTER character_knowledge_graph_prompt;
ALTER TABLE projects ADD COLUMN character_prompt TEXT AFTER character_integration_prompt;
