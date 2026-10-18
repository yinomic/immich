<script lang="ts">
  import { goto } from '$app/navigation';
  import { dateFormats } from '$lib/constants';
  import Portal from '$lib/elements/Portal.svelte';
  import { Route } from '$lib/route';
  import { getAlbumActions } from '$lib/services/album.service';
  import { locale } from '$lib/stores/preferences.store';
  import { type AlbumResponseDto } from '@immich/sdk';
  import { menuManager } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    album: AlbumResponseDto;
  };

  const { album }: Props = $props();

  let contextMenuAnchor: HTMLDivElement | undefined = $state();
  const items = $derived.by(() => {
    const { Edit, Download, Delete } = getAlbumActions($t, album);
    return [Edit, Download, Delete];
  });

  const dateLocaleString = (dateString: string) => {
    return new Date(dateString).toLocaleDateString($locale, dateFormats.album);
  };

  const oncontextmenu = async (event: MouseEvent) => {
    event.preventDefault();
    contextMenuAnchor?.setAttribute('style', `left: ${event.x}px; top: ${event.y}px;`);
    await menuManager.show({
      target: contextMenuAnchor ?? (event.currentTarget as HTMLElement),
      items,
    });
  };
</script>

<Portal>
  <div bind:this={contextMenuAnchor} class="absolute"></div>
</Portal>

<tr
  class="flex w-full place-items-center border-3 border-transparent p-2 text-center odd:bg-subtle/80 even:bg-subtle/20 hover:cursor-pointer hover:border-immich-primary/75 md:px-5 md:py-2 odd:dark:bg-immich-dark-gray/75 even:dark:bg-immich-dark-gray/50 dark:hover:border-immich-dark-primary/75"
  onclick={() => goto(Route.viewAlbum(album))}
  {oncontextmenu}
>
  <td class="text-md w-8/12 items-center text-start text-ellipsis sm:w-4/12 md:w-4/12 xl:w-[30%] 2xl:w-[40%]">
    {album.albumName}
  </td>
  <td class="text-md text-center text-ellipsis sm:w-2/12 md:w-2/12 xl:w-[15%] 2xl:w-[12%]">
    {$t('items_count', { values: { count: album.assetCount } })}
  </td>
  <td class="text-md hidden w-3/12 text-center text-ellipsis sm:block xl:w-[15%] 2xl:w-[12%]">
    {dateLocaleString(album.updatedAt)}
  </td>
  <td class="text-md hidden w-3/12 text-center text-ellipsis sm:block xl:w-[15%] 2xl:w-[12%]">
    {dateLocaleString(album.createdAt)}
  </td>
  <td class="text-md hidden text-center text-ellipsis xl:block xl:w-[15%] 2xl:w-[12%]">
    {#if album.endDate}
      {dateLocaleString(album.endDate)}
    {:else}
      -
    {/if}
  </td>
  <td class="text-md hidden text-center text-ellipsis xl:block xl:w-[15%] 2xl:w-[12%]">
    {#if album.startDate}
      {dateLocaleString(album.startDate)}
    {:else}
      -
    {/if}
  </td>
</tr>
