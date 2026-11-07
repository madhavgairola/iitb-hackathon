export const window = {
  showInputBox: async () => 'test instruction',
  showInformationMessage: async () => 'Accept Changes',
  showErrorMessage: async () => {},
  showWarningMessage: async () => {},
  withProgress: async (_options: any, task: any) => {
    return await task(
      { report: () => {} },
      { isCancellationRequested: false, onCancellationRequested: () => {} }
    );
  },
};

export const ProgressLocation = {
  Notification: 15,
};

export const Uri = {
  file: (f: string) => ({ fsPath: f, path: f, scheme: 'file', toString: () => `file://${f}` }),
  parse: (s: string) => ({ fsPath: s, path: s, scheme: s.split(':')[0], toString: () => s }),
};

export const commands = {
  executeCommand: async () => {},
};

export class EventEmitter {
  private listeners: Function[] = [];
  event = (listener: Function) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire = (data: any) => {
    this.listeners.forEach((l) => l(data));
  };
}
