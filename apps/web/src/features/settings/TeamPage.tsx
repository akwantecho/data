import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ORGANIZATION_ROLES, type OrganizationRole } from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { FormField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { describeApiError } from '../../lib/errors';
import { addMember, fetchTeam, removeMember, settingsKeys, updateMemberRole } from './settings-api';
import { SettingsLayout } from './SettingsLayout';

interface MemberForm {
  email: string;
  role: OrganizationRole;
  fullName: string;
  temporaryPassword: string;
}

export function TeamPage() {
  const { session, activeMembership } = useSession();
  const canEdit = activeMembership?.role === 'ORGANIZATION_ADMIN';
  const queryClient = useQueryClient();

  const [isAdding, setIsAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const teamQuery = useQuery({ queryKey: settingsKeys.team, queryFn: fetchTeam });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: settingsKeys.team });

  const addMutation = useMutation({
    mutationFn: addMember,
    onSuccess: async () => {
      setIsAdding(false);
      await invalidate();
    },
  });

  const roleMutation = useMutation({
    mutationFn: (input: { userId: string; role: OrganizationRole }) =>
      updateMemberRole(input.userId, input.role),
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
    },
    onError: (error) => setActionError(describeApiError(error)),
  });

  const removeMutation = useMutation({
    mutationFn: removeMember,
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
    },
    onError: (error) => setActionError(describeApiError(error)),
  });

  return (
    <SettingsLayout
      title="Team"
      description="Who can see and change this organization's data, and with which role."
    >
      <section className="card stack">
        <div className="section-header">
          <h2 className="card__title">Members</h2>
          {canEdit ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setActionError(null);
                setIsAdding(true);
              }}
            >
              Add member
            </button>
          ) : null}
        </div>

        {teamQuery.isPending ? <LoadingState label="Loading team…" /> : null}
        {teamQuery.isError ? <ErrorState message={describeApiError(teamQuery.error)} /> : null}
        {actionError ? <ErrorState message={actionError} /> : null}
        {teamQuery.data?.length === 0 ? <EmptyState message="No members yet." /> : null}

        {teamQuery.data && teamQuery.data.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
                {canEdit ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {teamQuery.data.map((member) => {
                const isSelf = member.userId === session?.user.id;

                return (
                  <tr key={member.userId}>
                    <td>
                      {member.fullName}
                      <span className="data-table__meta">{member.email}</span>
                    </td>
                    <td>
                      {canEdit ? (
                        <select
                          className="form-field__input form-field__input--inline"
                          aria-label={`Role for ${member.fullName}`}
                          value={member.role}
                          disabled={roleMutation.isPending}
                          onChange={(event) =>
                            roleMutation.mutate({
                              userId: member.userId,
                              role: event.target.value as OrganizationRole,
                            })
                          }
                        >
                          {ORGANIZATION_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {formatRole(role)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        formatRole(member.role)
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          member.status === 'ACTIVE' ? 'badge--positive' : 'badge--negative'
                        }`}
                      >
                        {member.status}
                      </span>
                    </td>
                    <td>
                      {member.lastLoginAt
                        ? new Date(member.lastLoginAt).toLocaleDateString()
                        : 'Never'}
                    </td>
                    {canEdit ? (
                      <td className="data-table__actions">
                        <button
                          type="button"
                          className="button button--ghost button--danger"
                          onClick={() => removeMutation.mutate(member.userId)}
                        >
                          {isSelf ? 'Leave' : 'Remove'}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </section>

      {isAdding ? (
        <AddMemberDialog
          isSaving={addMutation.isPending}
          error={addMutation.isError ? describeApiError(addMutation.error) : null}
          onCancel={() => setIsAdding(false)}
          onSubmit={(values) =>
            addMutation.mutate({
              email: values.email,
              role: values.role,
              // Only sent when creating a brand new account; ignored for existing users.
              ...(values.fullName ? { fullName: values.fullName } : {}),
              ...(values.temporaryPassword ? { temporaryPassword: values.temporaryPassword } : {}),
            })
          }
        />
      ) : null}
    </SettingsLayout>
  );
}

function AddMemberDialog({
  isSaving,
  error,
  onCancel,
  onSubmit,
}: {
  isSaving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: MemberForm) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<MemberForm>({
    defaultValues: { email: '', role: 'ANALYST', fullName: '', temporaryPassword: '' },
  });

  return (
    <Modal title="Add member" onClose={onCancel}>
      <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
        <p className="state">
          If the email already belongs to a platform user, they are simply added to this
          organization. Otherwise a new account is created with the initial password you set.
        </p>

        <FormField label="Email" htmlFor="member-email" error={errors.email?.message}>
          <input
            id="member-email"
            type="email"
            className="form-field__input"
            {...register('email', {
              required: 'Email is required',
              pattern: {
                value: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
                message: 'Enter a valid email address',
              },
            })}
          />
        </FormField>

        <FormField label="Role" htmlFor="member-role">
          <select id="member-role" className="form-field__input" {...register('role')}>
            {ORGANIZATION_ROLES.map((role) => (
              <option key={role} value={role}>
                {formatRole(role)}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Full name"
          htmlFor="member-name"
          hint="Required only for a new account."
          error={errors.fullName?.message}
        >
          <input id="member-name" className="form-field__input" {...register('fullName')} />
        </FormField>

        <FormField
          label="Initial password"
          htmlFor="member-password"
          hint="Required only for a new account. At least 12 characters, with upper case, lower case and a number."
          error={errors.temporaryPassword?.message}
        >
          <input
            id="member-password"
            type="password"
            className="form-field__input"
            autoComplete="new-password"
            {...register('temporaryPassword', {
              validate: (value) =>
                value === '' || value.length >= 12 || 'Password must be at least 12 characters',
            })}
          />
        </FormField>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={isSaving}>
            {isSaving ? 'Adding…' : 'Add to organization'}
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function formatRole(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
