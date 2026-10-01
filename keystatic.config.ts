import { config } from '@keystatic/core';
import { about } from './src/keystatic/about';
import { home } from './src/keystatic/home';
import { inquirePage } from './src/keystatic/inquirePage';
import { inquiryForm } from './src/keystatic/inquiryForm';
import { instagram } from './src/keystatic/instagram';
import { notFound } from './src/keystatic/notFound';
import { services } from './src/keystatic/services';
import { servicesPage } from './src/keystatic/servicesPage';
import { site } from './src/keystatic/site';

// Local file editing for development (`npm run dev:cms`); Keystatic Cloud in production,
// where Nat signs in with her email and password and every save commits to GitHub.
const storage =
    import.meta.env.PUBLIC_KEYSTATIC_STORAGE === 'local'
        ? ({ kind: 'local' } as const)
        : ({ kind: 'cloud' } as const);

export default config({
    storage,
    // Keystatic Cloud project (team/project). Public, not a secret; the env var only overrides it.
    cloud: { project: import.meta.env.PUBLIC_KEYSTATIC_CLOUD_PROJECT ?? 'curatedbynat/curatedbynat' },
    ui: {
        brand: { name: 'Curated by Nat' },
        navigation: {
            Pages: ['home', 'about', 'servicesPage', 'inquirePage', 'notFound'],
            'Services and photos': ['services', 'instagram'],
            'Inquiry form': ['inquiryForm'],
            'Every page': ['site'],
        },
    },
    singletons: {
        home,
        about,
        servicesPage,
        inquirePage,
        notFound,
        services,
        instagram,
        inquiryForm,
        site,
    },
});
