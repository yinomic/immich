<script lang="ts">
  /**
   * ICP filing info (备案信息) for deployments in mainland China.
   *
   * The server injects it into the served index.html as meta tags
   * (`immich-filing-info` / `immich-filing-url`) from the IMMICH_FILING_INFO and
   * IMMICH_FILING_URL environment variables, so nothing has to be added to the API
   * or the generated SDK. When the values are absent the component renders nothing.
   */
  const readMeta = (name: string) =>
    typeof document === 'undefined'
      ? undefined
      : document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;

  const info = readMeta('immich-filing-info');
  const url = readMeta('immich-filing-url') || 'https://beian.miit.gov.cn/';
</script>

{#if info}
  <div class="px-4 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
    <a href={url} target="_blank" rel="noopener noreferrer" class="hover:underline">{info}</a>
  </div>
{/if}
