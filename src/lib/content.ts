// Typed access to the content Nat edits in Keystatic. Each singleton is a JSON file in
// src/content/, imported directly so it works both at build time and inside the Worker.
import type { Entry } from '@keystatic/core/reader';
import type keystaticConfig from '../../keystatic.config';
import aboutData from '../content/about.json';
import homeData from '../content/home.json';
import inquirePageData from '../content/inquire-page.json';
import inquiryFormData from '../content/inquiry-form.json';
import instagramData from '../content/instagram.json';
import notFoundData from '../content/not-found.json';
import servicesData from '../content/services.json';
import servicesPageData from '../content/services-page.json';
import siteData from '../content/site.json';

type Singletons = (typeof keystaticConfig)['singletons'];

export type AboutContent = Entry<Singletons['about']>;
export type HomeContent = Entry<Singletons['home']>;
export type InquirePageContent = Entry<Singletons['inquirePage']>;
export type InquiryFormContent = Entry<Singletons['inquiryForm']>;
export type InstagramContent = Entry<Singletons['instagram']>;
export type NotFoundContent = Entry<Singletons['notFound']>;
export type ServicesContent = Entry<Singletons['services']>;
export type ServicesPageContent = Entry<Singletons['servicesPage']>;
export type SiteContent = Entry<Singletons['site']>;

export const about = aboutData as unknown as AboutContent;
export const home = homeData as unknown as HomeContent;
export const inquirePage = inquirePageData as unknown as InquirePageContent;
export const inquiryForm = inquiryFormData as unknown as InquiryFormContent;
export const instagram = instagramData as unknown as InstagramContent;
export const notFound = notFoundData as unknown as NotFoundContent;
export const services = servicesData as unknown as ServicesContent;
export const servicesPage = servicesPageData as unknown as ServicesPageContent;
export const site = siteData as unknown as SiteContent;
