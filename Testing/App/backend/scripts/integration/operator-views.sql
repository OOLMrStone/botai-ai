-- Only safe projections are granted. Auth secrets, session/OTP, reference answers,
-- exact provider output and S3 object keys are deliberately absent.
CREATE OR REPLACE VIEW operator_accounts AS SELECT id,display_name,role,enabled,created_at,plan_id,level_id,goal_id,daily_goal_minutes,time_zone FROM users;
CREATE OR REPLACE VIEW operator_tasks AS SELECT id,current_version_id,archived,created_at FROM tasks;
CREATE OR REPLACE VIEW operator_task_versions AS SELECT id,task_id,version,format_id,exam_number,difficulty,source_year,is_demo,created_at,sources,ai_input_ready,difficulty_level,is_grob FROM task_versions;
CREATE OR REPLACE VIEW operator_task_sources AS SELECT provider,external_id,task_id FROM task_source_links;
CREATE OR REPLACE VIEW operator_catalog_assets AS SELECT id,state,purpose,mime_type,size_bytes,width,height,original_sha256,normalized_sha256,created_at FROM catalog_assets;
CREATE OR REPLACE VIEW operator_import_runs AS SELECT id,manifest_sha256,state,created_at,finished_at FROM content_import_runs;
CREATE OR REPLACE VIEW operator_import_items AS SELECT run_id,ordinal,provider,external_id,state,reason,task_version_id FROM content_import_items;
CREATE OR REPLACE VIEW operator_attempts AS SELECT id,user_id,kind,template_id,format_id,status,revision,current_index,created_at,updated_at,completed_at FROM attempts;
CREATE OR REPLACE VIEW operator_attempt_items AS SELECT id,attempt_id,task_version_id,ordinal,answer_revision FROM attempt_items;
CREATE OR REPLACE VIEW operator_submissions AS SELECT id,user_id,attempt_id,attempt_item_id,task_version_id,input_revision,revision,status,retry_of_id,error_code,is_demo,provider_mode,created_at,updated_at FROM grading_submissions;
CREATE OR REPLACE VIEW operator_results AS SELECT submission_id,is_graded,score,max_score,is_demo,provider_mode,created_at FROM grading_results;
CREATE OR REPLACE VIEW operator_objects AS SELECT id,user_id,submission_id,purpose,state,mime_type,size_bytes,width,height,ordinal,created_at,retention_until,deleted_at FROM stored_objects;
CREATE OR REPLACE VIEW operator_jobs AS SELECT submission_id,state,fencing_token,lease_until,available_at,run_id,created_at,updated_at FROM grading_jobs;
CREATE OR REPLACE VIEW operator_runs AS SELECT id,submission_id,fencing_token,provider_mode,outcome,created_at,finished_at FROM grading_runs;
CREATE OR REPLACE VIEW operator_activity_days AS SELECT user_id,local_date,qualified,active_seconds FROM user_activity_days;
GRANT SELECT ON operator_accounts,operator_tasks,operator_task_versions,operator_attempts,operator_attempt_items,operator_submissions,operator_results,operator_objects,operator_jobs,operator_runs,operator_activity_days TO botai_operator;
GRANT SELECT ON operator_task_sources,operator_catalog_assets,operator_import_runs,operator_import_items TO botai_operator;
GRANT SELECT ON subjects,exam_formats,exam_positions,topics,task_version_topics,exam_templates,exam_template_items,plans,preparation_levels,preparation_goals TO botai_operator;
REVOKE ALL ON users,one_time_codes,spring_session,spring_session_attributes,task_version_answers,task_versions,grading_results,stored_objects FROM botai_operator;

REVOKE ALL ON operator_users FROM botai_operator;
REVOKE ALL ON task_source_links,task_version_provenance,catalog_assets,task_version_assets,content_import_runs,content_import_items,solution_reveal_grants FROM botai_operator;
