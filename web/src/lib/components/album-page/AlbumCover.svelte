<script lang="ts">
  import { cleanClass } from '$lib';
  import BrokenAsset from '$lib/components/assets/BrokenAsset.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { type AlbumResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    album: AlbumResponseDto;
    preload?: boolean;
    class?: string;
  }

  let { album, preload = false, class: className }: Props = $props();

  let alt = $derived(album.albumName || $t('unnamed_album'));
  let thumbnailUrl = $derived(
    album.albumThumbnailAssetId ? getAssetMediaUrl({ id: album.albumThumbnailAssetId }) : null,
  );
  let isBroken = $state(false);
</script>

{#if thumbnailUrl}
  {#if isBroken}
    <BrokenAsset hideMessage class="aspect-square rounded-xl" />
  {:else}
    <img
      {alt}
      onerror={() => (isBroken = true)}
      class={cleanClass('size-full rounded-xl object-cover aspect-square', className)}
      data-testid="album-image"
      draggable="false"
      loading={preload ? 'eager' : 'lazy'}
      src={thumbnailUrl}
    />
  {/if}
{:else}
  <enhanced:img
    {alt}
    class={cleanClass('size-full rounded-xl object-cover aspect-square', className)}
    data-testid="album-image"
    draggable="false"
    loading={preload ? 'eager' : 'lazy'}
    sizes="min(271px,186px)"
    src="$lib/assets/no-thumbnail.png"
  />
{/if}
