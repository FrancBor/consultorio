import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { runCreateAdmin } from '../scripts/create-admin.js';

function captureStream() {
  let value = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        value += chunk.toString();
        callback();
      },
    }),
    value: () => value,
  };
}

async function execute({ password, createAdmin }) {
  const output = captureStream();
  const errorOutput = captureStream();
  const close = vi.fn().mockResolvedValue(undefined);
  const exitCode = await runCreateAdmin({
    argumentsList: [
      '--username',
      'First.Admin',
      '--name',
      'Administrador inicial',
      '--password-stdin',
    ],
    input: Readable.from([`${password}\n`]),
    output: output.stream,
    errorOutput: errorOutput.stream,
    createRepository: () => ({ createAdmin }),
    close,
  });

  return { exitCode, output: output.value(), error: errorOutput.value(), close };
}

describe('admin creation CLI', () => {
  it('creates a valid active admin with an Argon2id hash', async () => {
    const createAdmin = vi.fn().mockResolvedValue({ id: '1' });
    const result = await execute({ password: 'a-secure-password', createAdmin });

    expect(result.exitCode).toBe(0);
    expect(createAdmin).toHaveBeenCalledOnce();
    const account = createAdmin.mock.calls[0][0];
    expect(account.username).toBe('first.admin');
    expect(account.passwordHash).toMatch(/^\$argon2id\$/);
    expect(result.output).toContain('creada correctamente');
    expect(result.close).toHaveBeenCalledOnce();
  });

  it('rejects a short password', async () => {
    const secret = 'short';
    const result = await execute({ password: secret, createAdmin: vi.fn() });

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('12');
    expect(`${result.output}${result.error}`).not.toContain(secret);
  });

  it('rejects an invalid username', async () => {
    const output = captureStream();
    const errorOutput = captureStream();
    const createAdmin = vi.fn();
    const exitCode = await runCreateAdmin({
      argumentsList: [
        '--username',
        'invalid username',
        '--name',
        'Administrador inicial',
        '--password-stdin',
      ],
      input: Readable.from(['a-secure-password\n']),
      output: output.stream,
      errorOutput: errorOutput.stream,
      createRepository: () => ({ createAdmin }),
    });

    expect(exitCode).toBe(1);
    expect(createAdmin).not.toHaveBeenCalled();
    expect(errorOutput.value()).toContain('usuario');
  });

  it('reports a duplicate without exposing the password', async () => {
    const secret = 'duplicate-secret-password';
    const databaseError = Object.assign(new Error('duplicate'), { code: '23505' });
    const result = await execute({
      password: secret,
      createAdmin: vi.fn().mockRejectedValue(databaseError),
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toBe('El usuario ya existe.\n');
    expect(`${result.output}${result.error}`).not.toContain(secret);
  });

  it('never accepts a password through command-line arguments', async () => {
    const output = captureStream();
    const errorOutput = captureStream();
    const secret = 'forbidden-argv-password';
    const exitCode = await runCreateAdmin({
      argumentsList: [
        '--username',
        'admin',
        '--name',
        'Admin',
        '--password',
        secret,
      ],
      input: Readable.from([]),
      output: output.stream,
      errorOutput: errorOutput.stream,
      createRepository: () => ({ createAdmin: vi.fn() }),
    });

    expect(exitCode).toBe(1);
    expect(`${output.value()}${errorOutput.value()}`).not.toContain(secret);
  });
});
