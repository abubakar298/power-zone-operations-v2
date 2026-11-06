-- Employee identity is independent of application login access.
CREATE TABLE employees (
 id uuid PRIMARY KEY,
 display_name text NOT NULL CHECK(length(trim(display_name))>0),
 designation text NOT NULL DEFAULT '',
 region text NOT NULL DEFAULT '',
 is_salesperson boolean NOT NULL DEFAULT false,
 user_id uuid UNIQUE REFERENCES users(id),
 active boolean NOT NULL DEFAULT true,
 notes text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX employee_directory_name ON employees(lower(trim(display_name)));
CREATE TABLE employee_directory_events (
 id uuid PRIMARY KEY,
 employee_id uuid NOT NULL REFERENCES employees(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL,
 before_value jsonb,
 after_value jsonb NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
