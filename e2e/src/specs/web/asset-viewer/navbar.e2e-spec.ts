import { AssetMediaResponseDto, LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils.js';

test.describe('Asset Viewer Navbar', () => {
  let admin: LoginResponseDto;
  let asset: AssetMediaResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  test.beforeEach(async () => {
    asset = await utils.createAsset(admin.accessToken);
  });

  test.describe('actions', () => {
    test('favorite asset with shortcut', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${asset.id}`);
      await page.waitForSelector('#immich-asset-viewer');
      await page.keyboard.press('f');
      await expect(page.getByText('Added to favorites')).toBeVisible();
    });
  });
});
