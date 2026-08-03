import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CheckForm from '../components/CheckForm.vue';
import ResultList from '../components/ResultList.vue';

describe('CheckForm', () => {
  it('emits the sanitized base name on submit', async () => {
    const wrapper = mount(CheckForm, { props: { busy: false } });
    await wrapper.find('input').setValue('  MyDomain.  ');
    await wrapper.find('form').trigger('submit');
    const emitted = wrapper.emitted('submit');
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual(['mydomain']);
  });

  it('does not emit for empty input', async () => {
    const wrapper = mount(CheckForm, { props: { busy: false } });
    await wrapper.find('input').setValue('   ');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeFalsy();
  });

  it('does not emit while busy', async () => {
    const wrapper = mount(CheckForm, { props: { busy: true } });
    await wrapper.find('input').setValue('foo');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeFalsy();
  });

  it('shows a busy label while checking', () => {
    const wrapper = mount(CheckForm, { props: { busy: true } });
    expect(wrapper.find('button').text()).toContain('Checking');
  });
});

describe('ResultList', () => {
  const items = [
    { fqdn: 'a.com', status: 'available' as const, source: 'doh' as const },
    { fqdn: 'b.net', status: 'available' as const, source: 'cache' as const },
  ];

  it('renders title with count and all fqdns', () => {
    const wrapper = mount(ResultList, {
      props: { title: 'Available', items, variant: 'available' },
    });
    expect(wrapper.text()).toContain('Available');
    expect(wrapper.text()).toContain('(2)');
    expect(wrapper.text()).toContain('a.com');
    expect(wrapper.text()).toContain('b.net');
  });

  it('badges cache-sourced entries', () => {
    const wrapper = mount(ResultList, {
      props: { title: 'Available', items, variant: 'available' },
    });
    const badges = wrapper.findAll('.result-list__badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].text()).toBe('cached');
  });

  it('renders empty state cleanly', () => {
    const wrapper = mount(ResultList, {
      props: { title: 'Not Available', items: [], variant: 'taken' },
    });
    expect(wrapper.text()).toContain('(0)');
    expect(wrapper.findAll('.result-list__item')).toHaveLength(0);
  });
});
