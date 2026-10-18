<script lang="ts">
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { handleUpdateAlbum } from '$lib/services/album.service';
  import { AssetOrder, type AlbumResponseDto } from '@immich/sdk';
  import { Field, Modal, ModalBody, Select, Stack, Text } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    album: AlbumResponseDto;
    readOnly?: boolean;
    onClose: () => void;
  };

  let { album, readOnly = false, onClose }: Props = $props();
</script>

<OnEvents onAlbumUpdate={(newAlbum) => (album = newAlbum)} />

<Modal title={readOnly ? $t('album') : $t('options')} {onClose} size="small">
  <ModalBody>
    <Stack gap={6}>
      <div>
        <Text size="medium" fontWeight="semi-bold">{$t('settings')}</Text>
        <div class="mt-2 grid gap-y-3 ps-2">
          {#if album.order}
            <Field label={$t('display_order')} disabled={readOnly}>
              <Select
                value={album.order}
                options={[
                  { label: $t('newest_first'), value: AssetOrder.Desc },
                  { label: $t('oldest_first'), value: AssetOrder.Asc },
                ]}
                onChange={(value) => handleUpdateAlbum(album, { order: value })}
              />
            </Field>
          {/if}
        </div>
      </div>
    </Stack>
  </ModalBody>
</Modal>
