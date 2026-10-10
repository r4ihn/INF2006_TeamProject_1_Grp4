import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addTeamMember, ApiError, updateTeamMember, type TeamMember } from '../api';
import { Field } from '../components/Field';
import { fieldAria } from '../components/fieldAria';

type Errors = { name?: string; email?: string; form?: string };

/**
 * The people who can be put on the roster (managers only). Adding someone here doesn't give
 * them a sign-in: the IT admin creates their account in Cognito with the same email, and it's
 * linked to this entry the first time they sign in.
 */
export function TeamPanel({
  team,
  onChanged,
}: {
  team: TeamMember[];
  /** Report what happened (shown as a notice by the page) */
  onChanged: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['team'] }),
      queryClient.invalidateQueries({ queryKey: ['shifts'] }),
    ]);

  const add = useMutation({
    mutationFn: addTeamMember,
    onSuccess: async (m) => {
      await refresh();
      setName('');
      setEmail('');
      onChanged(`Added ${m.name} to the team.`);
    },
    onError: (err) =>
      setErrors(
        err instanceof ApiError
          ? { ...err.fields, form: Object.keys(err.fields).length ? undefined : err.message }
          : { form: 'Something went wrong. Please try again.' },
      ),
  });

  const remove = useMutation({
    mutationFn: (m: TeamMember) => updateTeamMember(m.id, { onRoster: false }),
    onSuccess: async (m) => {
      await refresh();
      setConfirmingId(null);
      const opened = m.openedShifts;
      onChanged(
        `Removed ${m.name} from the roster.` +
          (opened ? ` ${opened} upcoming shift${opened === 1 ? ' is' : 's are'} now open.` : ''),
      );
    },
    onError: (err) => {
      setConfirmingId(null);
      setErrors({ form: err instanceof ApiError ? err.message : 'Couldn’t remove them.' });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const e: Errors = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'Enter a valid email address';
    setErrors(e);
    if (Object.keys(e).length === 0) add.mutate({ name: name.trim(), email: email.trim() });
  }

  return (
    <section className="card team" aria-labelledby={`${id}-title`}>
      <div className="team__header">
        <h2 className="team__title" id={`${id}-title`}>
          Team
        </h2>
        <p className="muted team__hint">
          Add people with the email they sign in with. Their sign-in account is created by your IT
          admin; it links to this entry the first time they sign in.
        </p>
      </div>

      {errors.form && (
        <p className="banner banner--error team__error" role="alert">
          {errors.form}
        </p>
      )}

      {team.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Team members</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id}>
                  <td className="cell-name">
                    <span className="cell-strong">{m.name}</span>
                    {(m.isYou || m.role === 'MANAGER' || !m.signedIn) && (
                      <span className="cell-badges">
                        {m.isYou && <span className="badge">You</span>}
                        {m.role === 'MANAGER' && <span className="badge">Manager</span>}
                        {!m.signedIn && (
                          <span className="badge badge--pending">Not signed in yet</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td data-label="Email">{m.email}</td>
                  <td className="actions">
                    {confirmingId === m.id ? (
                      <span
                        className="confirm"
                        role="group"
                        aria-label={`Confirm removing ${m.name}`}
                      >
                        <span>Remove {m.name}?</span>
                        <button type="button" onClick={() => setConfirmingId(null)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="button--danger"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(m)}
                        >
                          Remove
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="button--ghost-danger"
                        aria-label={`Remove ${m.name} from the roster`}
                        onClick={() => {
                          setErrors({});
                          setConfirmingId(m.id);
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="team__add" onSubmit={submit} noValidate aria-label="Add a team member">
        <Field id={`${id}-name`} label="Name" error={errors.name}>
          <input
            {...fieldAria(`${id}-name`, errors.name)}
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              setErrors((x) => ({ ...x, name: undefined, form: undefined }));
            }}
          />
        </Field>
        <Field id={`${id}-email`} label="Email" error={errors.email}>
          <input
            {...fieldAria(`${id}-email`, errors.email)}
            type="email"
            value={email}
            maxLength={254}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors((x) => ({ ...x, email: undefined, form: undefined }));
            }}
          />
        </Field>
        <button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add to team'}
        </button>
      </form>
    </section>
  );
}
