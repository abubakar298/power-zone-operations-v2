ALTER TABLE roles DROP CONSTRAINT roles_name_check;
ALTER TABLE roles ADD CONSTRAINT roles_name_check CHECK(name IN('Admin','Management','Employee','Coordinator'));
INSERT INTO roles(name) VALUES('Coordinator');
