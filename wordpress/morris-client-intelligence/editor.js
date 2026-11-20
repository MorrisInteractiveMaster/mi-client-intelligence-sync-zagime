(() => {
  const { registerBlockType } = window.wp.blocks;
  const { createElement: el } = window.wp.element;
  const { useBlockProps } = window.wp.blockEditor;
  const { SelectControl } = window.wp.components;
  const { __ } = window.wp.i18n;
  const options = [
    ["overview","Leadership Summary"], ["projects","Projects"], ["history","Reporting History"],
    ["directory","MI Directory"], ["milestones","Milestones"], ["area:finance","Finance"],
    ["area:hr","HR"], ["area:cfw","CFW"], ["area:health","Health"], ["area:miscellaneous","Miscellaneous"],
    ["area:training","Training"]
  ].map(([value,label]) => ({value, label: __(label,"morris-client-intelligence")}));
  registerBlockType("morris/client-intelligence", {
    title: __("Morris Client Intelligence", "morris-client-intelligence"),
    category: "widgets",
    edit({ attributes, setAttributes }) {
      return el("div", useBlockProps({ className: "mici-portal mici-portal--paper" }),
        el("h2", null, __("Morris Client Intelligence", "morris-client-intelligence")),
        el(SelectControl, { label: __("Portal destination", "morris-client-intelligence"), value: attributes.view,
          options, onChange: view => setAttributes({view}) }));
    },
    save: () => null
  });
})();
