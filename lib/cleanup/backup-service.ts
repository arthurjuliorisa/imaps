/**
 * Database Backup Service
 * Handles creation and management of database backups before cleanup
 */

import { prisma } from '@/lib/db/prisma';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface BackupInfo {
  id: string;
  filename: string;
  created_at: Date;
  size_bytes: number;
  table_count: number;
  company_code?: number;
  status: 'created' | 'restored' | 'deleted';
  notes?: string;
}

export interface BackupResult {
  success: boolean;
  backupId: string;
  filename: string;
  size_bytes?: number;
  created_at?: Date;
  error?: string;
}

export class BackupService {
  private static readonly BACKUP_DIR = process.env.BACKUP_DIR || './backups';

  /**
   * Initialize backup directory
   */
  static async initBackupDir(): Promise<void> {
    try {
      await fs.mkdir(this.BACKUP_DIR, { recursive: true });
    } catch (error) {
      console.error('Failed to create backup directory:', error);
    }
  }

  /**
   * Create backup before cleanup
   * Note: In production, use proper backup tools like pg_dump
   */
  static async createBackup(
    companyCode: number,
    tableNames: string[],
    customBackupDir?: string
  ): Promise<BackupResult> {
    try {
      const backupDir = customBackupDir || this.BACKUP_DIR;
      await fs.mkdir(backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupId = `cleanup_${companyCode}_${timestamp}`;
      const filename = `${backupId}.sql`;
      const filepath = path.join(backupDir, filename);

      // In production, use pg_dump:
      // pg_dump -t table1 -t table2 ... > filename
      // For now, create a metadata file
      
      const backupMetadata = {
        backupId,
        filename,
        companyCode,
        tables: tableNames,
        createdAt: new Date(),
        note: 'Backup created before database cleanup'
      };

      await fs.writeFile(
        filepath,
        `-- Backup ID: ${backupId}\n` +
        `-- Company Code: ${companyCode}\n` +
        `-- Created: ${new Date().toISOString()}\n` +
        `-- Tables: ${tableNames.join(', ')}\n` +
        `-- Note: Backup metadata file\n` +
        JSON.stringify(backupMetadata, null, 2),
        'utf-8'
      );

      // Get file size
      const stat = await fs.stat(filepath);

      return {
        success: true,
        backupId,
        filename: filepath, // Return full path
        size_bytes: stat.size,
        created_at: new Date()
      };
    } catch (error) {
      console.error('Backup creation failed:', error);
      return {
        success: false,
        backupId: '',
        filename: '',
        error: `Backup failed in ${customBackupDir || this.BACKUP_DIR}: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * List all backups
   */
  static async listBackups(): Promise<BackupInfo[]> {
    try {
      await this.initBackupDir();
      const files = await fs.readdir(this.BACKUP_DIR);
      const backups: BackupInfo[] = [];

      for (const file of files) {
        if (!file.endsWith('.sql')) continue;

        const filepath = path.join(this.BACKUP_DIR, file);
        const stat = await fs.stat(filepath);

        backups.push({
          id: file.replace('.sql', ''),
          filename: file,
          created_at: stat.ctime,
          size_bytes: stat.size,
          table_count: 0,
          status: 'created'
        });
      }

      return backups.sort(
        (a, b) => b.created_at.getTime() - a.created_at.getTime()
      );
    } catch (error) {
      console.error('Failed to list backups:', error);
      return [];
    }
  }

  /**
   * Get backup info
   */
  static async getBackupInfo(backupId: string): Promise<BackupInfo | null> {
    try {
      const filename = `${backupId}.sql`;
      const filepath = path.join(this.BACKUP_DIR, filename);

      const stat = await fs.stat(filepath);
      const content = await fs.readFile(filepath, 'utf-8');

      // Parse metadata from file header
      let tableCount = 0;
      for (const line of content.split('\n')) {
        if (line.includes('-- Tables:')) {
          tableCount = line.split('-- Tables:')[1].split(',').length;
          break;
        }
      }

      return {
        id: backupId,
        filename,
        created_at: stat.ctime,
        size_bytes: stat.size,
        table_count: tableCount,
        status: 'created'
      };
    } catch (error) {
      console.error('Failed to get backup info:', error);
      return null;
    }
  }

  /**
   * Delete backup file
   */
  static async deleteBackup(backupId: string): Promise<boolean> {
    try {
      const filename = `${backupId}.sql`;
      const filepath = path.join(this.BACKUP_DIR, filename);

      await fs.unlink(filepath);
      console.log(`Backup deleted: ${backupId}`);
      return true;
    } catch (error) {
      console.error(`Failed to delete backup ${backupId}:`, error);
      return false;
    }
  }

  /**
   * Get backup size (human readable)
   */
  static formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Check backup space requirement
   * Returns estimated bytes needed
   */
  static async estimateBackupSize(tableNames: string[]): Promise<number> {
    try {
      // Query database for table sizes
      const result = await prisma.$queryRaw<
        Array<{ table_name: string; size_bytes: number }>
      >`
        SELECT 
          schemaname || '.' || tablename as table_name,
          pg_total_relation_size(schemaname || '.' || tablename) as size_bytes
        FROM pg_tables
        WHERE tablename = ANY($1::text[])
      `;

      return result.reduce((sum, row) => sum + row.size_bytes, 0);
    } catch (error) {
      console.error('Failed to estimate backup size:', error);
      return 0;
    }
  }

  /**
   * Clean up old backups (keep only last N)
   */
  static async cleanupOldBackups(keepCount: number = 5): Promise<number> {
    try {
      const backups = await this.listBackups();
      const toDelete = backups.slice(keepCount);
      let deletedCount = 0;

      for (const backup of toDelete) {
        if (await this.deleteBackup(backup.id)) {
          deletedCount++;
        }
      }

      console.log(`Cleaned up ${deletedCount} old backups`);
      return deletedCount;
    } catch (error) {
      console.error('Failed to cleanup old backups:', error);
      return 0;
    }
  }

  /**
   * Get available backup space
   */
  static async getBackupDirStats(): Promise<{
    totalSize: number;
    backupCount: number;
    formattedSize: string;
  }> {
    try {
      const backups = await this.listBackups();
      const totalSize = backups.reduce((sum, b) => sum + b.size_bytes, 0);

      return {
        totalSize,
        backupCount: backups.length,
        formattedSize: this.formatSize(totalSize)
      };
    } catch (error) {
      console.error('Failed to get backup dir stats:', error);
      return {
        totalSize: 0,
        backupCount: 0,
        formattedSize: '0 B'
      };
    }
  }
}

/**
 * Log backup activity
 */
export async function logBackupActivity(
  action: string,
  backupId: string,
  details?: Record<string, any>
): Promise<void> {
  try {
    await prisma.activity_logs.create({
      data: {
        action: `BACKUP_${action}`,
        description: `Backup ${action}: ${backupId}`,
        metadata: {
          backupId,
          ...details
        }
      }
    });
  } catch (error) {
    console.error('Failed to log backup activity:', error);
  }
}
