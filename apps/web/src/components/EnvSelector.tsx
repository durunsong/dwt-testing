import { Select } from "antd";
import type { TestEnv } from "../types/settings";

const options: Array<{ label: string; value: TestEnv }> = [
  { label: "sit", value: "sit" },
  { label: "local", value: "local" },
  { label: "dev", value: "dev" },
  { label: "prod", value: "prod" }
];

interface EnvSelectorProps {
  value: TestEnv;
  disabled?: boolean;
  onChange: (env: TestEnv) => void;
}

export function EnvSelector({ value, disabled, onChange }: EnvSelectorProps) {
  return <Select className="min-w-40" value={value} disabled={disabled} options={options} onChange={onChange} />;
}
