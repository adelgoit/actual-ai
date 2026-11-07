import {
  importSession, initializeHost, signIn, signOut,
} from './chatgpt-auth';

async function main(): Promise<void> {
  if (process.argv[2] === 'init-host') {
    await initializeHost();
    console.log('ChatGPT host initialized.');
    return;
  }
  if (process.argv[2] === 'import') {
    if (!process.argv[3]) throw new Error('Usage: chatgpt-login import <credential-file>');
    await importSession(process.argv[3]);
    console.log('ChatGPT session imported for this host.');
    return;
  }
  if (process.argv[2] === 'logout') {
    const revoked = await signOut();
    console.log(revoked ? 'ChatGPT signed out.' : 'Local credentials removed; remote revocation could not be confirmed. Disconnect this app in ChatGPT settings.');
    return;
  }
  if (process.argv[2] && process.argv[2] !== 'login') {
    throw new Error('Usage: chatgpt-login [login|logout|init-host|import <credential-file>]');
  }
  if (process.platform === 'win32') {
    console.warn('Protect the ChatGPT credential directory with Windows user-only ACLs.');
  }
  if (process.env.CHATGPT_CALLBACK_PORT && process.env.CHATGPT_CALLBACK_PORT !== '0') {
    console.log('For remote sign-in, keep your SSH tunnel open until authorization completes.');
  }
  const account = await signIn();
  console.log(`ChatGPT connected: ${account}. Manage usage at https://chatgpt.com/#settings/usage`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'ChatGPT sign-in failed.');
  process.exitCode = 1;
});
