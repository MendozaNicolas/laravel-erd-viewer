import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLaravelMigrations, MigrationFileInput } from '../../src/core/laravel';

function loadFixtures(dirName: string): MigrationFileInput[] {
  const dirPath = path.resolve(__dirname, '../fixtures/laravel', dirName);
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.php'));
  return files.map((fileName) => ({
    path: `database/migrations/${fileName}`,
    content: fs.readFileSync(path.join(dirPath, fileName), 'utf-8'),
  }));
}

describe('Laravel Migrations Parser', () => {
  describe('Default Laravel migrations', () => {
    it('parses standard Laravel 11/12 default migrations', () => {
      const files = loadFixtures('default');
      const ir = parseLaravelMigrations(files);

      expect(ir.tables).toHaveLength(5);
      const tableNames = ir.tables.map((t) => t.name);
      expect(tableNames).toContain('users');
      expect(tableNames).toContain('password_reset_tokens');
      expect(tableNames).toContain('failed_jobs');
      expect(tableNames).toContain('cache');
      expect(tableNames).toContain('cache_locks');

      // Validate users table
      const users = ir.tables.find((t) => t.name === 'users')!;
      expect(users).toBeDefined();

      const idCol = users.columns.find((c) => c.name === 'id')!;
      expect(idCol.type).toBe('bigInteger');
      expect(idCol.primary).toBe(true);
      expect(idCol.autoIncrement).toBe(true);
      expect(idCol.unsigned).toBe(true);

      const emailCol = users.columns.find((c) => c.name === 'email')!;
      expect(emailCol.type).toBe('string');
      expect(emailCol.unique).toBe(true);

      const emailVerifiedCol = users.columns.find((c) => c.name === 'email_verified_at')!;
      expect(emailVerifiedCol.nullable).toBe(true);

      const rememberToken = users.columns.find((c) => c.name === 'remember_token')!;
      expect(rememberToken.nullable).toBe(true);
      expect(rememberToken.length).toBe(100);

      const createdAt = users.columns.find((c) => c.name === 'created_at')!;
      const updatedAt = users.columns.find((c) => c.name === 'updated_at')!;
      expect(createdAt).toBeDefined();
      expect(updatedAt).toBeDefined();

      // Validate password_reset_tokens
      const pwTokens = ir.tables.find((t) => t.name === 'password_reset_tokens')!;
      const pwEmail = pwTokens.columns.find((c) => c.name === 'email')!;
      expect(pwEmail.primary).toBe(true);
    });
  });

  describe('Blog schema & relationships', () => {
    it('parses tables, explicit FKs, inferred FKs, and polymorphic markers', () => {
      const defaultFiles = loadFixtures('default');
      const blogFiles = loadFixtures('blog');
      const ir = parseLaravelMigrations([...defaultFiles, ...blogFiles]);

      const tableNames = ir.tables.map((t) => t.name);
      expect(tableNames).toContain('categories');
      expect(tableNames).toContain('posts');
      expect(tableNames).toContain('comments');
      expect(tableNames).toContain('tags');
      expect(tableNames).toContain('post_tag');
      expect(tableNames).toContain('taggables');

      // Check posts columns
      const posts = ir.tables.find((t) => t.name === 'posts')!;
      const isPublished = posts.columns.find((c) => c.name === 'is_published')!;
      expect(isPublished.default).toBe(false);
      const deletedAt = posts.columns.find((c) => c.name === 'deleted_at')!;
      expect(deletedAt.nullable).toBe(true);

      // Check explicit relations
      const postUserRel = ir.relations.find(
        (r) => r.from.table === 'posts' && r.from.column === 'user_id'
      )!;
      expect(postUserRel).toBeDefined();
      expect(postUserRel.to.table).toBe('users');
      expect(postUserRel.to.column).toBe('id');
      expect(postUserRel.onDelete).toBe('cascade');
      expect(postUserRel.kind).toBe('explicit');

      const postCatRel = ir.relations.find(
        (r) => r.from.table === 'posts' && r.from.column === 'category_id'
      )!;
      expect(postCatRel).toBeDefined();
      expect(postCatRel.to.table).toBe('categories');
      expect(postCatRel.onDelete).toBe('set null');

      // Check comments post_id table-level relation
      const commentPostRel = ir.relations.find(
        (r) => r.from.table === 'comments' && r.from.column === 'post_id'
      )!;
      expect(commentPostRel).toBeDefined();
      expect(commentPostRel.to.table).toBe('posts');
      expect(commentPostRel.onDelete).toBe('cascade');

      // Check inferred relation: comments.user_id -> users.id
      const commentUserRel = ir.relations.find(
        (r) => r.from.table === 'comments' && r.from.column === 'user_id'
      )!;
      expect(commentUserRel).toBeDefined();
      expect(commentUserRel.to.table).toBe('users');
      expect(commentUserRel.to.column).toBe('id');
      expect(commentUserRel.kind).toBe('inferred');

      // Check polymorphic relation for taggables
      const polyRel = ir.relations.find((r) => r.kind === 'polymorphic')!;
      expect(polyRel).toBeDefined();
      expect(polyRel.from.table).toBe('taggables');
      expect(polyRel.from.column).toBe('taggable_id');
      expect(polyRel.to.table).toBe('*');
    });

    it('can disable inferred relations via options', () => {
      const defaultFiles = loadFixtures('default');
      const blogFiles = loadFixtures('blog');
      const ir = parseLaravelMigrations([...defaultFiles, ...blogFiles], { inferRelations: false });

      const inferred = ir.relations.filter((r) => r.kind === 'inferred');
      expect(inferred).toHaveLength(0);
    });
  });

  describe('Alterations & chronologic ordering', () => {
    it('applies alterations (renameColumn, dropColumn, dropIfExists) in sequence', () => {
      const files = loadFixtures('alterations');
      const ir = parseLaravelMigrations(files);

      const tableNames = ir.tables.map((t) => t.name);
      expect(tableNames).toContain('articles');
      expect(tableNames).not.toContain('legacy_table'); // Was dropped

      const articles = ir.tables.find((t) => t.name === 'articles')!;
      const colNames = articles.columns.map((c) => c.name);

      expect(colNames).toContain('body'); // Renamed from old_body
      expect(colNames).not.toContain('old_body');
      expect(colNames).not.toContain('temp_col'); // Dropped
      expect(colNames).toContain('subtitle'); // Added in alter
    });
  });

  describe('Resilience & dirty migrations', () => {
    it('handles malformed statements, raw SQL, and dynamic variables without throwing', () => {
      const files = loadFixtures('dirty');
      expect(() => {
        const ir = parseLaravelMigrations(files);
        expect(ir.tables.some((t) => t.name === 'valid_in_dirty')).toBe(true);
        expect(ir.warnings.length).toBeGreaterThan(0);
        expect(ir.warnings.some((w) => w.code === 'DYNAMIC_VALUE')).toBe(true);
      }).not.toThrow();
    });

    it('handles PHP syntax errors gracefully without throwing', () => {
      const brokenFiles = [
        {
          path: 'database/migrations/2024_09_09_broken.php',
          content: '<?php broken syntax {{{ <<< >>>',
        },
      ];
      expect(() => {
        const ir = parseLaravelMigrations(brokenFiles);
        expect(ir.warnings.some((w) => w.code === 'PARSE_ERROR')).toBe(true);
      }).not.toThrow();
    });
  });

  describe('Determinism', () => {
    it('produces deep-equal IR when run twice on the same inputs', () => {
      const files = [...loadFixtures('default'), ...loadFixtures('blog')];
      const ir1 = parseLaravelMigrations(files);
      const ir2 = parseLaravelMigrations(files);
      expect(ir1).toEqual(ir2);
    });
  });
});
