import { useState, type FormEvent } from 'react';
import { isValidSessionCode, normalizeSessionCode } from '../api';

interface JoinScreenProps {
  initialValue?: string;
  onJoin: (code: string) => void;
}

export function JoinScreen({ initialValue, onJoin }: JoinScreenProps) {
  const [value, setValue] = useState(() => normalizeSessionCode(initialValue ?? ''));
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!isValidSessionCode(value)) {
      setError('Enter the 6-character code shown on your TV.');
      return;
    }
    setError(null);
    onJoin(value);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (pasted) {
      event.preventDefault();
      setValue(normalizeSessionCode(pasted));
    }
  };

  return (
    <div className="join">
      <div>
        <h1 className="join__title">Join what's on TV</h1>
        <p className="join__subtitle">
          Enter the session code shown on your Fire TV, or scan its QR code, to ask
          spoiler-safe questions from your phone.
        </p>
      </div>
      <form className="code-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="session-code" className="visually-hidden">
          Session code
        </label>
        <input
          id="session-code"
          name="code"
          className="code-input"
          value={value}
          onChange={(event) => setValue(normalizeSessionCode(event.target.value))}
          onPaste={handlePaste}
          placeholder="ABCXYZ"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          maxLength={6}
          aria-describedby={error ? 'session-code-error' : undefined}
          aria-invalid={error ? true : undefined}
        />
        <p className="form-error" id="session-code-error" aria-live="polite">
          {error ?? ''}
        </p>
        <button type="submit" className="btn btn--primary" disabled={value.length !== 6}>
          Watch along
        </button>
      </form>
    </div>
  );
}
