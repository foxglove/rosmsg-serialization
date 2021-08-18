import { parse as parseMessageDefinition } from "@foxglove/rosmsg";

import { LazyMessageReader } from "./LazyMessageReader";
import messageReaderTests from "./fixtures/messageReaderTests";

describe("LazyReader", () => {
  it.each(messageReaderTests)(
    "should deserialize %s",
    (msgDef: string, arr: Iterable<number>, expected: Record<string, unknown>) => {
      const buffer = Uint8Array.from(arr);
      const reader = new LazyMessageReader(parseMessageDefinition(msgDef));

      // allows for easier review of the generated parser source
      expect(reader.source()).toMatchSnapshot(msgDef);

      // read aligned array
      {
        const read = reader.readMessage(buffer);

        // check that our reader expected size matches the buffer size
        expect(reader.size(buffer)).toEqual(buffer.length);

        // check that our message matches the object
        expect(read.toJSON()).toEqual(expected);
      }

      // read offset array
      {
        const offset = 7;
        const fullArr = new Uint8Array(buffer.length + offset);
        fullArr.set(buffer, offset);

        const read = reader.readMessage(
          new Uint8Array(fullArr.buffer, fullArr.byteOffset + offset, fullArr.byteLength - offset),
        );
        expect(reader.size(buffer)).toEqual(buffer.length);
        expect(read.toJSON()).toEqual(expected);
      }
    },
  );
});
