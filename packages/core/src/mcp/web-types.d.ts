// The MCP SDK's types name the fetch API's HeadersInit, which only DOM's lib declares globally.
// This project builds without DOM, so derive it from Node's global Headers.
type HeadersInit = NonNullable<ConstructorParameters<typeof Headers>[0]>;
