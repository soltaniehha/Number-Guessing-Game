import { Component } from 'react'

/**
 * Wraps components owned by other parts of the codebase (the cabin renderer,
 * the chart grid) so a fault in one of them degrades to a message instead of
 * blanking the whole lab.
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
        <p className="alert alert--bad">
          {this.props.label} could not render: {this.state.error.message}
        </p>
      )
    }
    return this.props.children
  }
}
