-- Separate support identity: no Management, financial or pricing-policy authority.
ALTER TABLE roles DROP CONSTRAINT roles_name_check;
ALTER TABLE roles ADD CONSTRAINT roles_name_check CHECK(name IN('Admin','Management','Employee','Coordinator','Operations','Inventory','Accounts','Design','IT Support'));
INSERT INTO roles(name) VALUES('IT Support');
