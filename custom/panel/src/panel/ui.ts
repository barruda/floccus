// State shared across the panel's components: the search box (tag chips anywhere write
// "#tag" into it), which screen is showing, and the bookmark whose tags are being edited.
import { reactive } from 'vue'
import { toggleTagInQuery } from '../tags/model'

export const ui = reactive({
  query: '',
  view: 'browse' as 'browse' | 'tags',
  editing: null as { url: string; title: string } | null,
})

export function toggleTagFilter(tag: string) {
  ui.view = 'browse'
  ui.query = toggleTagInQuery(ui.query, tag)
}
