import type { ReactNode } from 'react';
import { Page } from '../../app/Page';
import { Card } from '../../ui/Card';
import { Section } from '../../ui/GroupedList';
import CheckupPanel from '../settings/CheckupPanel';
import LocationInsights from './LocationInsights';
import AiUsage from './AiUsage';
import SuccessMeasures from './SuccessMeasures';
import WeeklyReview from './WeeklyReview';
import Patterns from './Patterns';
import ScoutCards from '../today/ScoutCards';

/** A titled Insights block, named for screen readers by its title. */
function Block({
  title,
  card = true,
  children,
}: {
  title: string;
  card?: boolean;
  children: ReactNode;
}) {
  return (
    <Section title={title} label={title}>
      {card ? <Card>{children}</Card> : children}
    </Section>
  );
}

export default function InsightsPage() {
  return (
    <Page title="Insights">
      <Block title="This week">
        <WeeklyReview />
      </Block>
      <ScoutCards />
      <Block title="Patterns">
        <Patterns />
      </Block>
      <Block title="Success measures" card={false}>
        <SuccessMeasures />
      </Block>
      <Block title="AI usage">
        <AiUsage />
      </Block>
      <Block title="Memory check-up">
        <CheckupPanel auto />
      </Block>
      <Block title="Where I worked">
        <LocationInsights />
      </Block>
    </Page>
  );
}
