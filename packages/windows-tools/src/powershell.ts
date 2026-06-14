/**
 * PowerShell受控执行
 * 一期仅提供基础框架，不实际执行PowerShell命令
 */

/** PowerShell执行结果 */
export interface PowerShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * 执行PowerShell命令（受控）
 * 一期仅占位，不实际执行
 * @param command - PowerShell命令
 * @param readOnly - 是否只读命令
 */
export async function executePowerShell(_command: string, _readOnly = true): Promise<PowerShellResult> {
  // 一期不执行任何PowerShell命令
  return {
    success: false,
    stdout: '',
    stderr: 'PowerShell execution not implemented in v1',
    exitCode: -1,
  };
}
