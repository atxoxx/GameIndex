/**
 * Diagnostics commands: the rolling log, breadcrumbs and crash reports that
 * the Settings → Diagnostics tab renders.
 */
import type { CommandHandler } from "../ipc";
import {
  clearCrashLog,
  crashLogStatus,
  deleteCrashReport,
  readCrashLog,
  recordBreadcrumb,
  recordCrash,
  type CrashRecordInput,
} from "../features/diagnostics/crashLog";

export const diagnosticsCommands: Record<string, CommandHandler> = {
  crashlog_status: () => crashLogStatus(),

  crashlog_read: (args) => readCrashLog(args.name),

  crashlog_clear: () => {
    clearCrashLog();
    return null;
  },

  crashlog_delete_report: (args) => deleteCrashReport(args.name),

  crashlog_breadcrumb: (args) => {
    recordBreadcrumb(args.area, args.message);
    return null;
  },

  crashlog_record: (args) => {
    const input: CrashRecordInput = {
      ...args,
      message: String(args.message ?? "Unknown frontend crash"),
    };
    return recordCrash(input);
  },
};
