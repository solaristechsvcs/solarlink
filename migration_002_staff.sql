-- Run once after migration_001_appearance.sql, with the application stopped.
ALTER TABLE users ADD COLUMN role ENUM('user','staff','admin') NOT NULL DEFAULT 'user', ADD COLUMN suspended TINYINT(1) NOT NULL DEFAULT 0;
CREATE TABLE staff_guard (id TINYINT PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO staff_guard(id) VALUES(1);
CREATE TABLE staff_audit (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 actor_id BIGINT UNSIGNED NOT NULL,
 target_id BIGINT UNSIGNED NOT NULL,
 action VARCHAR(32) NOT NULL,
 old_value VARCHAR(32) NOT NULL,
 new_value VARCHAR(32) NOT NULL,
 reason VARCHAR(500) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX(target_id,created_at), INDEX(actor_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
