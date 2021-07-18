import { parse as parseMessageDefinition } from "@foxglove/rosmsg";

import { LazyMessageReader } from "./LazyMessageReader";
import messageReaderTests from "./fixtures/messageReaderTests";

describe("LazyReader", () => {
  it.each(messageReaderTests)(
    "should deserialize %s",
    (msgDef: string, arr: Iterable<number>, expected: Record<string, unknown>) => {
      const buffer = Uint8Array.from(arr);
      const reader = new LazyMessageReader(parseMessageDefinition(msgDef));
      const read = reader.readMessage(buffer);

      // check that our reader expected size matches the buffer size
      expect(reader.size(buffer)).toEqual(buffer.length);

      // allows for easier review of the generated parser source
      expect(reader.source()).toMatchSnapshot(msgDef);

      // check that our message matches the object
      expect(read.toJSON()).toEqual(expected);
    },
  );
});
