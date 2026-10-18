<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { updateMyPreferences } from '@immich/sdk';
  import { Button, Field, Switch, toastManager } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  let emailNotificationsEnabled = $state(authManager.preferences.emailNotifications?.enabled ?? true);

  const handleSave = async () => {
    try {
      const response = await updateMyPreferences({
        userPreferencesUpdateDto: {
          emailNotifications: {
            enabled: emailNotificationsEnabled,
          },
        },
      });

      authManager.setPreferences(response);
      toastManager.primary($t('saved_settings'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_settings'));
    }
  };

  const onsubmit = (event: Event) => {
    event.preventDefault();
  };

  const disabled = $derived(!emailNotificationsEnabled);
</script>

<section class="my-4">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" {onsubmit}>
      <div class="flex flex-col gap-6 sm:ms-8">
        <Field label={$t('enable')} description={$t('notification_toggle_setting_description')}>
          <Switch bind:checked={emailNotificationsEnabled} />
        </Field>
      </div>

      <div class="mt-4 flex justify-end">
        <Button shape="round" type="submit" size="small" onclick={() => handleSave()}>{$t('save')}</Button>
      </div>
    </form>
  </div>
</section>
