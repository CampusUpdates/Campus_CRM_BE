-- Create partial unique index on User table to enforce single ACTIVE Super Admin
CREATE UNIQUE INDEX "unique_active_super_admin" ON "User" ("roleId") WHERE ("roleId" = 1 AND "status" = 'ACTIVE');
