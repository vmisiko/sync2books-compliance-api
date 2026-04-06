-- Run once against MySQL (no database selected), e.g.:
--   mysql -h localhost -P 3306 -u root -p < scripts/create-database.sql
-- Or paste into TablePlus / MySQL Workbench.

CREATE DATABASE IF NOT EXISTS `compliance`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
