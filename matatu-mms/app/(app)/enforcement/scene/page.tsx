import { getOffenceTypes } from "@/lib/data";
import PageBanner from "@/components/PageBanner";
import EnforcementSceneForm from "@/components/EnforcementSceneForm";

export default async function EnforcementScenePage() {
  const offenceTypes = await getOffenceTypes();

  return (
    <div className="space-y-6">
      <PageBanner
        eyebrow="Nairobi City County · Enforcement"
        title="Report Offence at Scene"
        subtitle="For Arresting Officers — plate number, offence, and action taken. The fine locks automatically from the offence you select."
      />
      <EnforcementSceneForm offenceTypes={offenceTypes} />
    </div>
  );
}
