import '@testing-library/jest-dom';
import { render } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import AuthPageLayout from './AuthPageLayout.svelte';

const addFilingMeta = (info: string, url = 'https://beian.miit.gov.cn/') => {
  for (const [name, content] of [
    ['immich-filing-info', info],
    ['immich-filing-url', url],
  ]) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', name);
    meta.setAttribute('content', content);
    document.head.append(meta);
  }
};

describe('AuthPageLayout', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
  });

  afterEach(() => {
    for (const meta of document.head.querySelectorAll('meta[name^="immich-filing-"]')) {
      meta.remove();
    }
  });

  it('puts the ICP filing info in a footer at the bottom of the page', () => {
    addFilingMeta('粤ICP备12345678号-1');

    const sut = render(AuthPageLayout, { title: 'Login' });

    const section = sut.container.querySelector('section');
    const footer = sut.container.querySelector('footer');

    // the page flows top to bottom, so the filing info cannot end up next to the card
    expect(section?.className).toContain('flex-col');
    expect(footer).toBeInTheDocument();
    expect(section?.lastElementChild).toBe(footer);
    expect(footer).toHaveTextContent('粤ICP备12345678号-1');

    // the login card is the block right above the footer
    expect(footer?.previousElementSibling).toHaveTextContent('Login');
  });

  it('renders nothing when no filing info is configured', () => {
    const sut = render(AuthPageLayout, { title: 'Login' });

    expect(sut.container.querySelector('footer a')).toBeNull();
    expect(sut.container.querySelector('section')?.className).toContain('flex-col');
  });
});
