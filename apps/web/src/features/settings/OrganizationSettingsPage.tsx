import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { OrganizationSummary } from '@sip/shared-types';
import { useSession } from '../auth/session-context';
import { ErrorState, LoadingState } from '../../components/states';
import { FormField } from '../../components/FormField';
import { describeApiError } from '../../lib/errors';
import {
  fetchIndustries,
  fetchOrganization,
  setIndustry,
  settingsKeys,
  updateOrganization,
} from './settings-api';
import { SettingsLayout } from './SettingsLayout';

interface ProfileForm {
  name: string;
  countryCode: string;
  currencyCode: string;
  timezone: string;
}

export function OrganizationSettingsPage() {
  const { activeMembership } = useSession();
  const canEdit = activeMembership?.role === 'ORGANIZATION_ADMIN';
  const queryClient = useQueryClient();

  const organizationQuery = useQuery({
    queryKey: settingsKeys.organization,
    queryFn: fetchOrganization,
  });
  const industriesQuery = useQuery({
    queryKey: settingsKeys.industries,
    queryFn: fetchIndustries,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileForm>();

  // The form mirrors server state, so it is re-seeded whenever that state changes.
  useEffect(() => {
    if (organizationQuery.data) {
      reset(toFormValues(organizationQuery.data));
    }
  }, [organizationQuery.data, reset]);

  const profileMutation = useMutation({
    mutationFn: updateOrganization,
    onSuccess: (organization) => {
      queryClient.setQueryData(settingsKeys.organization, organization);
      reset(toFormValues(organization));
    },
  });

  const industryMutation = useMutation({
    mutationFn: setIndustry,
    onSuccess: (organization) => {
      queryClient.setQueryData(settingsKeys.organization, organization);
    },
  });

  return (
    <SettingsLayout
      title="Organization"
      description="Profile, locale and industry. The industry decides which metric pack the organization uses."
    >
      {organizationQuery.isPending ? <LoadingState label="Loading organization…" /> : null}
      {organizationQuery.isError ? (
        <ErrorState message={describeApiError(organizationQuery.error)} />
      ) : null}

      {organizationQuery.data ? (
        <>
          <section className="card">
            <form
              className="stack form-grid"
              onSubmit={handleSubmit((values) => profileMutation.mutate(values))}
              noValidate
            >
              <FormField label="Name" htmlFor="name" error={errors.name?.message}>
                <input
                  id="name"
                  className="form-field__input"
                  disabled={!canEdit}
                  {...register('name', {
                    required: 'Name is required',
                    minLength: { value: 2, message: 'Name must be at least 2 characters' },
                  })}
                />
              </FormField>

              <FormField
                label="Country"
                htmlFor="countryCode"
                hint="Two-letter ISO code, for example OM"
                error={errors.countryCode?.message}
              >
                <input
                  id="countryCode"
                  className="form-field__input"
                  disabled={!canEdit}
                  {...register('countryCode', {
                    required: 'Country is required',
                    pattern: { value: /^[A-Za-z]{2}$/, message: 'Use a 2-letter ISO code' },
                  })}
                />
              </FormField>

              <FormField
                label="Currency"
                htmlFor="currencyCode"
                hint="Three-letter ISO code, for example OMR"
                error={errors.currencyCode?.message}
              >
                <input
                  id="currencyCode"
                  className="form-field__input"
                  disabled={!canEdit}
                  {...register('currencyCode', {
                    required: 'Currency is required',
                    pattern: { value: /^[A-Za-z]{3}$/, message: 'Use a 3-letter ISO code' },
                  })}
                />
              </FormField>

              <FormField
                label="Timezone"
                htmlFor="timezone"
                hint="IANA name, for example Asia/Muscat"
                error={errors.timezone?.message}
              >
                <input
                  id="timezone"
                  className="form-field__input"
                  disabled={!canEdit}
                  {...register('timezone', { required: 'Timezone is required' })}
                />
              </FormField>

              {profileMutation.isError ? (
                <p className="form-error" role="alert">
                  {describeApiError(profileMutation.error)}
                </p>
              ) : null}

              {canEdit ? (
                <div className="form-actions">
                  <button
                    type="submit"
                    className="button button--primary"
                    disabled={!isDirty || profileMutation.isPending}
                  >
                    {profileMutation.isPending ? 'Saving…' : 'Save changes'}
                  </button>
                  {profileMutation.isSuccess && !isDirty ? (
                    <span className="state" role="status">
                      Saved
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="state">
                  Only an organization administrator can change these details.
                </p>
              )}
            </form>
          </section>

          <section className="card stack">
            <h2 className="card__title">Industry</h2>
            <p className="state">
              {organizationQuery.data.industryName
                ? `Current industry: ${organizationQuery.data.industryName}.`
                : 'No industry selected yet.'}{' '}
              The industry cannot be changed once data has been imported.
            </p>

            <FormField label="Industry" htmlFor="industryId">
              <select
                id="industryId"
                className="form-field__input"
                disabled={!canEdit || industriesQuery.isPending || industryMutation.isPending}
                value={organizationQuery.data.industryId ?? ''}
                onChange={(event) => {
                  if (event.target.value) {
                    industryMutation.mutate(event.target.value);
                  }
                }}
              >
                <option value="">Select an industry…</option>
                {(industriesQuery.data ?? []).map((industry) => (
                  <option key={industry.id} value={industry.id}>
                    {industry.name}
                  </option>
                ))}
              </select>
            </FormField>

            {industryMutation.isError ? (
              <p className="form-error" role="alert">
                {describeApiError(industryMutation.error)}
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </SettingsLayout>
  );
}

function toFormValues(organization: OrganizationSummary): ProfileForm {
  return {
    name: organization.name,
    countryCode: organization.countryCode,
    currencyCode: organization.currencyCode,
    timezone: organization.timezone,
  };
}
