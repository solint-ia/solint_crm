import type { Metadata } from 'next';
import { OnboardingWizard } from '@/features/auth/components/onboarding-wizard';

export const metadata: Metadata = { title: 'Configuração Inicial · Solint CRM' };

export default function OnboardingPage() {
  return <OnboardingWizard />;
}
