import { Component } from 'react'

/**
 * Wraps components owned by other parts of the codebase (the cabin renderer,
 * the chart grid) so a fault in one of them degrades to a message instead of
 * blanking the whole lab.
 *
 * It also wraps the store itself (see `App.jsx`). That boundary should never
 * fire — the config a link carries is validated before anything dereferences
 * it — but "should never" is what a shared link full of somebody else's JSON
 * makes of a promise, and the failure mode without a boundary is a white page
 * with no way back except editing the URL by hand. `recovery` is the way back.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="alert alert--bad" role="alert">
          <p>
            {this.props.label} could not render: {this.state.error.message}
          </p>
          {this.props.recovery}
        </div>
      )
    }
    return this.props.children
  }
}
