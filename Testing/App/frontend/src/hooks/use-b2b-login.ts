import { useState } from 'react';

export function useB2bLogin(onSubmit: (email: string, password: string) => Promise<unknown>) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit() {
    if (!email.trim() || !password) return;
    const signedIn = await onSubmit(email.trim(), password);
    if (signedIn === true) setPassword('');
  }

  return { email, password, setEmail, setPassword, submit };
}
