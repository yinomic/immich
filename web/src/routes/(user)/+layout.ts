import { authenticate } from '$lib/utils/auth';
import { getAssetInfoFromParam } from '$lib/utils/navigation';
import type { LayoutLoad } from './$types';

export const load = (async ({ url, params }) => {
  await authenticate(url);
  const asset = await getAssetInfoFromParam(params);

  return {
    asset,
  };
}) satisfies LayoutLoad;
